"use server";
import { createServiceRoleClient } from "@/services/utils/supabase/service_role";
import { getRepoInfo, getRepoLanguages } from '@/services/utils/github';

// Define the Project type based on the table schema
export interface Project {
  id?: bigint;
  name: string | null;
  description: string | null;
  thumbnail_image: string | null;
  github_url: string | null;
  github_full_slug: string | null;
  groups: string | null;
  contributions: string | null;
  languages: string | null;
  paid_bounties: boolean | null;
  issues_count: any | null; // Using 'any' for jsonb type
  stars_count: number | null;
  project_uuid?: string;
  icon_image: string | null;
  communities: any | null; // Using 'any' for jsonb type
  hacktoberfest: boolean | null;
}

// Add this interface for the user-project linking
export interface UserProject {
  id?: bigint;
  user_id: string;
  project_id: bigint;
  role_number: number;
  created_at?: string;
}

export interface CreateProjectResponse {
  project: Project | null;
  error: string | null;
}

const supabase = createServiceRoleClient();

// Create a new project
export async function createProject(
  project: Omit<Project, "id" | "project_uuid" | "created_at" | "updated_at" | "thumbnail_image" | "icon_image" | "issues_count" | "stars_count" | "description" | "languages" | "hacktoberfest">,
  user_id: string
): Promise<CreateProjectResponse> {
  // Extract owner and repo from github_full_slug
  const [owner, repo] = project.github_full_slug?.split('/') || [];

  if (!owner || !repo) {
    console.error("Invalid GitHub URL");
    return { project: null, error: "Invalid GitHub URL" };
  }

  // Check if there is already a project with the same github_full_slug
  const { data: existingProject, error: projectError } = await supabase.from("projects").select("*").eq("github_full_slug", project.github_full_slug).single();

  if (existingProject) {
    console.error("Project with this GitHub URL already exists");
    return { project: null, error: "Project with this GitHub URL already exists" };
  }

  try {
    // Get repository information from GitHub API
    const repoInfo = await getRepoInfo(owner, repo);
    const repoLanguages = await getRepoLanguages(owner, repo);
    
    // Parse and format languages
    const formattedLanguages = Object.keys(repoLanguages).map(lang => lang.toLowerCase()).join(', ');
    
    // Check if the repository has the Hacktoberfest topic
    const hasHacktoberfestTopic = repoInfo.topics && repoInfo.topics.includes('hacktoberfest');
    
    // Update project with fetched data
    const updatedProject = {
      ...project,
      issues_count: repoInfo.open_issues_count,
      stars_count: repoInfo.stargazers_count,
      icon_image: repoInfo.owner.avatar_url,
      description: repoInfo.description,
      languages: formattedLanguages,
      hacktoberfest: hasHacktoberfestTopic
    };

    const { data: projectData, error: projectError } = await supabase.from("projects").insert(updatedProject).select().single();

    if (projectError) {
      console.error("Error creating project:", projectError);
      return { project: null, error: "Error creating project" };
    }

    if (projectData) {
      const userProject: UserProject = {
        user_id: user_id,
        project_id: projectData.id as bigint,
        role_number: 5,
      };

      const { error: linkError } = await supabase.from("userprojects").insert(userProject);

      if (linkError) {
        console.error("Error linking user to project:", linkError);
        // Consider whether to delete the project if linking fails
        // For now, we'll return the project even if linking fails
      }
    }

    return { project: projectData, error: null };
  } catch (error) {
    console.error("Error fetching repository information:", error);
    return { project: null, error: "Error fetching repository information" };
  }
}

//uid
export async function getProjectByUuid(uuid: string): Promise<Project | null> {
  const { data: data, error: error } = await supabase.from("projects").select("*").eq("project_uuid", uuid).single();
  
  if (error) {
    console.error("Error fetching project by UUID:", error);
    return null;
  }

  return data;
}

// Read a project by its ID
export async function getProjectById(id: number): Promise<Project | null> {
  const { data, error } = await supabase.from("projects").select("*").eq("id", id).single();

  if (error) {
    console.error("Error fetching project:", error);
    return null;
  }

  return data;
}

// Read all projects
export async function getAllProjects(): Promise<Project[]> {
  const { data, error } = await supabase.from("projects").select("*").order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching projects:", error);
    return [];
  }

  return data || [];
}

// Update a project
export async function updateProject(id: number, updates: Partial<Project>): Promise<Project | null> {
  const { data, error } = await supabase.from("projects").update(updates).eq("id", id).select().single();

  if (error) {
    console.error("Error updating project:", error);
    return null;
  }

  return data;
}

// Delete a project
export async function deleteProject(id: number): Promise<boolean> {
  const { error } = await supabase.from("projects").delete().eq("id", id);

  if (error) {
    console.error("Error deleting project:", error);
    return false;
  }

  return true;
}

// Search projects by name or description
export async function searchProjects(query: string): Promise<Project[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .or(`name.ilike.%${query}%,description.ilike.%${query}%`)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error searching projects:", error);
    return [];
  }

  return data || [];
}

// Get projects by group
export async function getProjectsByGroup(group: string): Promise<Project[]> {
  const { data, error } = await supabase.from("projects").select("*").ilike("groups", `%${group}%`).order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching projects by group:", error);
    return [];
  }

  return data || [];
}

// Get projects by user_id
export async function getProjectsByUserId(user_id: string): Promise<Project[]> {
  const { data, error } = await supabase
    .from("projects")
    .select(
      `
      *,
      userprojects!inner(user_id)
    `
    )
    .eq("userprojects.user_id", user_id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching projects by user_id:", error);
    return [];
  }

  return data || [];
}

export async function getProjectsByMultipleFilters(
  group: string,
  contributions: string,
  query: string,
  page: number = 1,
  pageSize: number = 10,
  minStars?: number,
  maxStars?: number,
  language?: string,
  seed?: string,
  hacktoberfest?: boolean
): Promise<{ projects: Project[]; totalCount: number }> {
  const { data, error } = await supabase
    .rpc('filter_projects_v2', {
      p_group: group,
      p_contributions: contributions,
      p_query: query,
      p_page: page,
      p_page_size: pageSize,
      p_min_stars: minStars ?? null,
      p_max_stars: maxStars ?? null,
      p_language: language ?? null,
      p_seed: seed ?? null,
      p_hacktoberfest: hacktoberfest ?? null
    });

  if (error) {
    console.error("Error fetching projects by multiple filters:", error);
    return { projects: [], totalCount: 0 };
  }

  const projects = data.map((item: any) => item.project_data);
  const totalCount = data[0]?.total_count || 0;

  return { projects, totalCount };
}

export async function getProjectsByMultipleFiltersSUPABASE(
  group: string,
  contributions: string,
  query: string,
  page: number = 1,
  pageSize: number = 10,
  minStars?: number,
  maxStars?: number,
  language?: string
): Promise<{ projects: Project[]; totalCount: number }> {
  let queryBuilder = supabase
    .from("projects")
    .select("*", { count: "exact" })
    .ilike("groups", `%${group}%`)
    .ilike("contributions", `%${contributions}%`)
    .or(`name.ilike.%${query}%,description.ilike.%${query}%`);

  if (minStars !== undefined) {
    queryBuilder = queryBuilder.gte("stars_count", minStars);
  }
  if (maxStars !== undefined) {
    queryBuilder = queryBuilder.lte("stars_count", maxStars === Infinity ? "Infinity" : maxStars);
  }
  if (language) {
    queryBuilder = queryBuilder.ilike("languages", `%${language}%`);
  }

  const { data, error, count } = await queryBuilder.range((page - 1) * pageSize, page * pageSize - 1);

  if (error) {
    console.error("Error fetching projects by group, contributions, query, stars, and language:", error);
    return { projects: [], totalCount: 0 };
  }

  return { projects: data || [], totalCount: count || 0 };
}

// check if user has right to edit project
export async function checkUserRightToEditProject(user_id: string, project_id: number): Promise<boolean> {
  const { data, error } = await supabase.from("userprojects").select("*").eq("user_id", user_id).eq("project_id", project_id).single();

  if (error) {
    console.error("Error checking user right to edit project:", error);
    return false;
  }

  return data ? true : false;
}

// Edit a project
export async function editProject(user_id: string, project_id: number, updates: Partial<Project>): Promise<Project | null> {
  // First, check if the user has the right to edit the project
  const hasRight = await checkUserRightToEditProject(user_id, project_id);

  if (!hasRight) {
    console.error("User does not have the right to edit this project");
    return null;
  }

  // If the user has the right, proceed with the update
  const { data, error } = await supabase.from("projects").update(updates).eq("id", project_id).select().single();

  if (error) {
    console.error("Error editing project:", error);
    return null;
  }

  return data;
}

export async function syncProjectWithGitHub(project_id: number): Promise<Project | null> {
  // Fetch the current project data
  const currentProject = await getProjectById(project_id);
  
  if (!currentProject || !currentProject.github_full_slug) {
    console.error("Project not found or missing GitHub information");
    return null;
  }

  const [owner, repo] = currentProject.github_full_slug.split('/');

  try {
    // Fetch updated information from GitHub
    const repoInfo = await getRepoInfo(owner, repo);
    const repoLanguages = await getRepoLanguages(owner, repo);
    
    // Parse and format languages
    const formattedLanguages = Object.keys(repoLanguages).map(lang => lang.toLowerCase()).join(', ');
    
    // Check if the repository has the Hacktoberfest topic
    const hasHacktoberfestTopic = repoInfo.topics && repoInfo.topics.includes('hacktoberfest');
    console.log(repoInfo.topics);
    console.log(hasHacktoberfestTopic);
    
    // Prepare updates
    const updates: Partial<Project> = {
      name: repoInfo.name,
      description: repoInfo.description,
      icon_image: repoInfo.owner.avatar_url,
      issues_count: repoInfo.open_issues_count,
      stars_count: repoInfo.stargazers_count,
      languages: formattedLanguages,
      hacktoberfest: hasHacktoberfestTopic
    };

    // Update the project in the database
    const updatedProject = await updateProject(project_id, updates);

    if (!updatedProject) {
      console.error("Failed to update project with synced data");
      return null;
    }

    return updatedProject;
  } catch (error) {
    console.error("Error syncing project with GitHub:", error);
    return null;
  }
}
